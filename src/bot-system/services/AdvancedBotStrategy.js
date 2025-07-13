const logger = require('../../config/logger');
const prisma = require('../../config/database');

class AdvancedBotStrategy {
  constructor() {
    // Natural behavior patterns for realistic gameplay
    this.behaviorPatterns = {
      thinkingTime: {
        min: 800,    // Minimum thinking time (ms)
        max: 3500,   // Maximum thinking time (ms)
        firstCard: { min: 1000, max: 2500 },
        secondCard: { min: 1500, max: 3000 },
        matchFound: { min: 500, max: 1200 },  // Faster when remembering
        confused: { min: 2500, max: 4000 }     // Slower when "unsure"
      },
      
      // Mouse movement patterns (simulated via delays)
      mousePatterns: {
        directClick: 0.4,      // 40% chance of direct click
        hoverFirst: 0.4,       // 40% chance to hover before clicking
        changesMind: 0.2       // 20% chance to almost click wrong card first
      },
      
      // Memory patterns
      memoryPatterns: {
        perfectRecall: 0.3,    // 30% chance to remember perfectly
        partialRecall: 0.5,    // 50% chance to remember some cards
        forgetful: 0.2         // 20% chance to "forget" cards
      },
      
      // Mistake patterns
      mistakePatterns: {
        misclick: 0.05,        // 5% chance to click adjacent card
        forgetMatch: 0.15,     // 15% chance to forget a known match
        repeatCard: 0.1        // 10% chance to click same card location
      }
    };
    
    // Win rate tracking (per bot over last N games)
    this.winRateWindow = 10; // Track last 10 games
    this.targetWinRate = 0.5; // 50% target
    this.winRateTolerance = 0.1; // Allow 40-60% range
  }

  // Get bot's recent performance stats
  async getBotStats(botId) {
    try {
      // Get last N games for this bot
      const recentGames = await prisma.game.findMany({
        where: {
          participants: {
            some: { userId: botId }
          },
          status: 'COMPLETED'
        },
        orderBy: { endedAt: 'desc' },
        take: this.winRateWindow,
        include: {
          participants: true
        }
      });
      
      if (recentGames.length === 0) {
        return { winRate: 0.5, gamesPlayed: 0, shouldAdjust: false };
      }
      
      // Calculate win rate
      const wins = recentGames.filter(game => {
        const botParticipant = game.participants.find(p => p.userId === botId);
        return botParticipant && botParticipant.position === 1;
      }).length;
      
      const winRate = wins / recentGames.length;
      const shouldAdjust = recentGames.length >= 5; // Start adjusting after 5 games
      
      return {
        winRate,
        gamesPlayed: recentGames.length,
        shouldAdjust,
        needsToWin: winRate < (this.targetWinRate - this.winRateTolerance),
        needsToLose: winRate > (this.targetWinRate + this.winRateTolerance)
      };
    } catch (error) {
      logger.error(`Error getting bot stats for ${botId}:`, error);
      return { winRate: 0.5, gamesPlayed: 0, shouldAdjust: false };
    }
  }

  // Calculate performance level based on win rate needs
  async calculatePerformanceLevel(botId, baseSkillLevel = 0.5) {
    const stats = await this.getBotStats(botId);
    
    if (!stats.shouldAdjust) {
      return baseSkillLevel;
    }
    
    // Adjust performance to maintain 50% win rate
    if (stats.needsToWin) {
      // Bot needs to win more - increase skill subtly
      const adjustment = Math.min(0.3, (this.targetWinRate - stats.winRate) * 0.5);
      return Math.min(0.8, baseSkillLevel + adjustment);
    } else if (stats.needsToLose) {
      // Bot needs to lose more - decrease skill subtly
      const adjustment = Math.min(0.3, (stats.winRate - this.targetWinRate) * 0.5);
      return Math.max(0.2, baseSkillLevel - adjustment);
    }
    
    return baseSkillLevel;
  }

  // Generate human-like thinking time
  generateThinkingTime(situation, performanceLevel) {
    const pattern = this.behaviorPatterns.thinkingTime[situation] || 
                   this.behaviorPatterns.thinkingTime;
    
    // Adjust based on performance level (better players think faster)
    const speedMultiplier = 1.5 - performanceLevel; // 0.5 to 1.3
    
    const min = pattern.min * speedMultiplier;
    const max = pattern.max * speedMultiplier;
    
    // Add natural variation
    const variation = Math.random() * (max - min) + min;
    
    // Occasionally add "double-check" time
    if (Math.random() < 0.2) {
      return variation + (Math.random() * 500 + 300);
    }
    
    return Math.floor(variation);
  }

  // Simulate human-like card selection
  async selectCardWithHumanBehavior(gameState, botId, availableCards, knownCards = new Map()) {
    const performanceLevel = await this.calculatePerformanceLevel(botId);
    const stats = await this.getBotStats(botId);
    
    // Determine memory quality for this turn
    const memoryRoll = Math.random();
    let memoryQuality = 'partial';
    if (memoryRoll < this.behaviorPatterns.memoryPatterns.perfectRecall * performanceLevel) {
      memoryQuality = 'perfect';
    } else if (memoryRoll > 1 - this.behaviorPatterns.memoryPatterns.forgetful) {
      memoryQuality = 'forgetful';
    }
    
    // First card selection
    let firstCardIndex = await this.selectFirstCard(
      availableCards, 
      knownCards, 
      memoryQuality, 
      performanceLevel,
      stats
    );
    
    // Generate thinking time
    const firstCardDelay = this.generateThinkingTime('firstCard', performanceLevel);
    
    // Simulate "almost clicking" wrong card
    const changeMindRoll = Math.random();
    let almostClickedIndex = null;
    if (changeMindRoll < this.behaviorPatterns.mousePatterns.changesMind) {
      // Pick a different card that bot "almost" clicked
      const otherCards = availableCards.filter(idx => idx !== firstCardIndex);
      if (otherCards.length > 0) {
        almostClickedIndex = otherCards[Math.floor(Math.random() * otherCards.length)];
      }
    }
    
    return {
      firstCard: {
        index: firstCardIndex,
        delay: firstCardDelay,
        almostClicked: almostClickedIndex
      },
      secondCardCallback: async (firstCardValue) => {
        // Second card selection with knowledge of first card
        const remainingCards = availableCards.filter(idx => idx !== firstCardIndex);
        
        let secondCardIndex = await this.selectSecondCard(
          remainingCards,
          knownCards,
          firstCardValue,
          firstCardIndex,
          memoryQuality,
          performanceLevel,
          stats
        );
        
        // Determine delay based on whether bot "knows" it's a match
        const situation = this.knowsMatch(firstCardValue, secondCardIndex, knownCards) 
          ? 'matchFound' 
          : 'secondCard';
        const secondCardDelay = this.generateThinkingTime(situation, performanceLevel);
        
        return {
          index: secondCardIndex,
          delay: secondCardDelay
        };
      }
    };
  }

  // Select first card with human-like strategy
  async selectFirstCard(availableCards, knownCards, memoryQuality, performanceLevel, stats) {
    // If bot needs to lose, occasionally make poor choices
    if (stats.needsToLose && Math.random() < 0.3) {
      // Pick a random card, ignoring memory
      return availableCards[Math.floor(Math.random() * availableCards.length)];
    }
    
    // Check for known pairs
    if (memoryQuality !== 'forgetful') {
      const knownPairs = this.findKnownPairs(knownCards, availableCards);
      if (knownPairs.length > 0 && Math.random() < performanceLevel) {
        // Pick from known pairs based on performance
        const pair = knownPairs[Math.floor(Math.random() * knownPairs.length)];
        return Math.random() < 0.5 ? pair[0] : pair[1];
      }
    }
    
    // Strategic selection based on position preference
    return this.selectStrategicCard(availableCards, knownCards, performanceLevel);
  }

  // Select second card with knowledge of first
  async selectSecondCard(availableCards, knownCards, firstCardValue, firstCardIndex, 
                         memoryQuality, performanceLevel, stats) {
    // If bot needs to lose, occasionally miss obvious matches
    if (stats.needsToLose && Math.random() < 0.4) {
      // Pick random card even if match is known
      return availableCards[Math.floor(Math.random() * availableCards.length)];
    }
    
    // Check if we know the match
    if (memoryQuality !== 'forgetful') {
      for (const [index, value] of knownCards) {
        if (value === firstCardValue && availableCards.includes(index)) {
          // Apply "forget match" mistake pattern
          if (Math.random() > this.behaviorPatterns.mistakePatterns.forgetMatch * (1 - performanceLevel)) {
            return index; // Found the match!
          }
        }
      }
    }
    
    // If bot needs to win, be more strategic
    if (stats.needsToWin) {
      // Try positions that commonly have matches (corners, edges)
      const strategicPositions = this.getStrategicPositions(availableCards);
      if (strategicPositions.length > 0) {
        return strategicPositions[Math.floor(Math.random() * strategicPositions.length)];
      }
    }
    
    // Random selection with position bias
    return this.selectWithPositionBias(availableCards, performanceLevel);
  }

  // Find known matching pairs
  findKnownPairs(knownCards, availableCards) {
    const pairs = [];
    const checked = new Set();
    
    for (const [index1, value1] of knownCards) {
      if (checked.has(index1) || !availableCards.includes(index1)) continue;
      
      for (const [index2, value2] of knownCards) {
        if (index1 !== index2 && value1 === value2 && 
            availableCards.includes(index2) && !checked.has(index2)) {
          pairs.push([index1, index2]);
          checked.add(index1);
          checked.add(index2);
          break;
        }
      }
    }
    
    return pairs;
  }

  // Select card with strategic positioning
  selectStrategicCard(availableCards, knownCards, performanceLevel) {
    // Prefer unexplored cards
    const unexplored = availableCards.filter(idx => !knownCards.has(idx));
    
    if (unexplored.length > 0 && Math.random() < performanceLevel) {
      // Strategic players explore systematically
      if (performanceLevel > 0.7) {
        // Prefer corners and edges
        const strategic = this.getStrategicPositions(unexplored);
        if (strategic.length > 0) {
          return strategic[Math.floor(Math.random() * strategic.length)];
        }
      }
      return unexplored[Math.floor(Math.random() * unexplored.length)];
    }
    
    return availableCards[Math.floor(Math.random() * availableCards.length)];
  }

  // Get strategic positions (corners, edges)
  getStrategicPositions(positions) {
    // Assuming 4x4 grid (0-15)
    const corners = [0, 3, 12, 15];
    const edges = [1, 2, 4, 7, 8, 11, 13, 14];
    
    const strategic = positions.filter(pos => 
      corners.includes(pos) || edges.includes(pos)
    );
    
    return strategic.length > 0 ? strategic : positions;
  }

  // Select with position bias (humans often have patterns)
  selectWithPositionBias(availableCards, performanceLevel) {
    // Simulate human tendency to pick certain positions
    const biases = {
      center: 0.3,      // Tendency to pick center cards
      corners: 0.2,     // Tendency to pick corners
      sequential: 0.2,  // Tendency to pick adjacent cards
      random: 0.3       // True random
    };
    
    const roll = Math.random();
    
    if (roll < biases.center) {
      // Prefer center positions (5,6,9,10 in 4x4 grid)
      const centerCards = availableCards.filter(idx => [5,6,9,10].includes(idx));
      if (centerCards.length > 0) {
        return centerCards[Math.floor(Math.random() * centerCards.length)];
      }
    }
    
    // Default to random
    return availableCards[Math.floor(Math.random() * availableCards.length)];
  }

  // Check if bot knows this is a match
  knowsMatch(cardValue, cardIndex, knownCards) {
    for (const [index, value] of knownCards) {
      if (index === cardIndex && value === cardValue) {
        return true;
      }
    }
    return false;
  }

  // Add natural mistakes
  applyMistakePattern(selectedIndex, availableCards, mistakeType) {
    const roll = Math.random();
    
    if (mistakeType === 'misclick' && roll < this.behaviorPatterns.mistakePatterns.misclick) {
      // Simulate misclick to adjacent card
      const adjacent = this.getAdjacentCards(selectedIndex);
      const validAdjacent = adjacent.filter(idx => availableCards.includes(idx));
      if (validAdjacent.length > 0) {
        return validAdjacent[Math.floor(Math.random() * validAdjacent.length)];
      }
    }
    
    return selectedIndex;
  }

  // Get adjacent card positions (for misclick simulation)
  getAdjacentCards(index) {
    // For 4x4 grid
    const row = Math.floor(index / 4);
    const col = index % 4;
    const adjacent = [];
    
    // Check all 8 directions
    const directions = [
      [-1, 0], [1, 0], [0, -1], [0, 1],  // Cardinal
      [-1, -1], [-1, 1], [1, -1], [1, 1] // Diagonal
    ];
    
    for (const [dr, dc] of directions) {
      const newRow = row + dr;
      const newCol = col + dc;
      if (newRow >= 0 && newRow < 4 && newCol >= 0 && newCol < 4) {
        adjacent.push(newRow * 4 + newCol);
      }
    }
    
    return adjacent;
  }
}

module.exports = new AdvancedBotStrategy();