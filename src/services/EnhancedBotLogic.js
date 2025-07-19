// Enhanced Bot Logic for New 10-Type Bot System
// This file contains the new bot intelligence functions for winning and normal bots

class EnhancedBotLogic {
  // Perfect memory match for winning bots (100% accuracy)
  static findPerfectMemoryMatch(availableCards, botMemory, board) {
    // Winning bots have perfect memory recall
    for (const [position, symbol] of botMemory.rememberedCards) {
      const matchingCard = availableCards.find(({ index }) => {
        const rememberedSymbol = botMemory.rememberedCards.get(index);
        return rememberedSymbol === symbol && index !== position;
      });
      
      if (matchingCard) {
        // Perfect bots always find the match if they remember it
        botMemory.strategicMoves++;
        return availableCards.find(({ index }) => index === position);
      }
    }
    return null;
  }

  // Human-like memory match for normal bots (with mistakes)
  static findHumanLikeMemoryMatch(availableCards, botMemory, board) {
    const memoryAccuracy = botMemory.botConfig.humanBehavior.memoryAccuracy;
    
    for (const [position, symbol] of botMemory.rememberedCards) {
      const matchingCard = availableCards.find(({ index }) => {
        const rememberedSymbol = botMemory.rememberedCards.get(index);
        return rememberedSymbol === symbol && index !== position;
      });
      
      if (matchingCard && Math.random() < memoryAccuracy) {
        return availableCards.find(({ index }) => index === position);
      }
    }
    return null;
  }

  // Strategic card selection for winning bots
  static selectStrategicCard(availableCards, botMemory, gameState) {
    const intelligence = botMemory.intelligence;
    
    switch (intelligence) {
      case 'strategic':
        return this.strategicMasterSelection(availableCards, botMemory);
      case 'analytical':
        return this.analyticalGeniusSelection(availableCards, botMemory, gameState);
      case 'tactical':
        return this.tacticalExpertSelection(availableCards, botMemory);
      case 'adaptive':
        return this.adaptiveChampionSelection(availableCards, botMemory);
      case 'intuitive':
        return this.intuitivePlayerSelection(availableCards, botMemory);
      case 'calculated':
        return this.calculatedWinnerSelection(availableCards, botMemory);
      case 'competitive':
        return this.smartCompetitorSelection(availableCards, botMemory);
      default:
        return this.strategicMasterSelection(availableCards, botMemory);
    }
  }

  // Human-like card selection for normal bots
  static selectHumanLikeCard(availableCards, botMemory, gameState) {
    const intelligence = botMemory.intelligence;
    
    switch (intelligence) {
      case 'casual':
        return this.casualPlayerSelection(availableCards, botMemory);
      case 'random':
        return this.randomPlayerSelection(availableCards, botMemory);
      case 'beginner':
        return this.beginnerBotSelection(availableCards, botMemory);
      default:
        return this.casualPlayerSelection(availableCards, botMemory);
    }
  }

  // Strategic Master - Systematic exploration with corner/edge preference
  static strategicMasterSelection(availableCards, botMemory) {
    // Prioritize corners and edges for maximum information gain
    const strategicPositions = [0, 4, 5, 9, 10, 14, 15, 19, 20, 24, 25, 29, 1, 3, 6, 8];
    
    for (const pos of strategicPositions) {
      const card = availableCards.find(({ index }) => index === pos);
      if (card) return card;
    }
    
    // If no strategic positions available, pick systematically
    return availableCards[0];
  }

  // Analytical Genius - Pattern-based selection with center preference
  static analyticalGeniusSelection(availableCards, botMemory, gameState) {
    // Analyze board patterns and select center cards for maximum visibility
    const centerPositions = [6, 7, 8, 11, 12, 13, 16, 17, 18, 21, 22, 23];
    const centerCards = availableCards.filter(({ index }) => centerPositions.includes(index));
    
    if (centerCards.length > 0) {
      return centerCards[0]; // Always pick first available center card
    }
    
    return availableCards[0];
  }

  // Tactical Expert - Unexplored area focus
  static tacticalExpertSelection(availableCards, botMemory) {
    // Focus on areas not yet explored
    const unexplored = availableCards.filter(({ index }) => !botMemory.rememberedCards.has(index));
    
    if (unexplored.length > 0) {
      // Pick from unexplored systematically
      return unexplored[0];
    }
    
    return availableCards[0];
  }

  // Adaptive Champion - Dynamic strategy based on game state
  static adaptiveChampionSelection(availableCards, botMemory) {
    // Adapt strategy based on memory size and game progress
    if (botMemory.rememberedCards.size < 5) {
      // Early game: explore systematically
      const unexplored = availableCards.filter(({ index }) => !botMemory.rememberedCards.has(index));
      if (unexplored.length > 0) return unexplored[0];
    } else {
      // Late game: use memory more aggressively
      const remembered = availableCards.filter(({ index }) => botMemory.rememberedCards.has(index));
      if (remembered.length > 0) return remembered[0];
    }
    
    return availableCards[0];
  }

  // Intuitive Player - Gut feeling with slight randomness
  static intuitivePlayerSelection(availableCards, botMemory) {
    // Make intuitive choices with slight preference for certain positions
    const preferredPositions = [7, 8, 11, 12, 17, 18, 21, 22]; // Center-ish positions
    
    for (const pos of preferredPositions) {
      const card = availableCards.find(({ index }) => index === pos);
      if (card) return card;
    }
    
    return availableCards[0];
  }

  // Calculated Winner - Methodical approach
  static calculatedWinnerSelection(availableCards, botMemory) {
    // Methodical selection with calculated risk
    const methodicalOrder = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29];
    
    for (const pos of methodicalOrder) {
      const card = availableCards.find(({ index }) => index === pos);
      if (card) return card;
    }
    
    return availableCards[0];
  }

  // Smart Competitor - Aggressive and fast
  static smartCompetitorSelection(availableCards, botMemory) {
    // Aggressive selection with preference for quick wins
    const aggressivePositions = [0, 4, 5, 9, 24, 25, 29, 20, 10, 14, 15, 19];
    
    for (const pos of aggressivePositions) {
      const card = availableCards.find(({ index }) => index === pos);
      if (card) return card;
    }
    
    return availableCards[0];
  }

  // Casual Player - Random with some patterns
  static casualPlayerSelection(availableCards, botMemory) {
    // Casual selection with mistakes
    const mistakeProbability = botMemory.botConfig.humanBehavior.mistakeProbability;
    
    if (Math.random() < mistakeProbability) {
      // Make a random mistake
      return availableCards[Math.floor(Math.random() * availableCards.length)];
    }
    
    // Otherwise, pick somewhat strategically
    const remembered = availableCards.filter(({ index }) => botMemory.rememberedCards.has(index));
    if (remembered.length > 0 && Math.random() < 0.6) {
      return remembered[Math.floor(Math.random() * remembered.length)];
    }
    
    return availableCards[Math.floor(Math.random() * availableCards.length)];
  }

  // Random Player - Mostly random choices
  static randomPlayerSelection(availableCards, botMemory) {
    // Mostly random with very occasional memory use
    if (botMemory.rememberedCards.size > 0 && Math.random() < 0.3) {
      const remembered = availableCards.filter(({ index }) => botMemory.rememberedCards.has(index));
      if (remembered.length > 0) {
        return remembered[Math.floor(Math.random() * remembered.length)];
      }
    }
    
    return availableCards[Math.floor(Math.random() * availableCards.length)];
  }

  // Beginner Bot - Poor strategy with many mistakes
  static beginnerBotSelection(availableCards, botMemory) {
    // Beginner makes many mistakes and poor choices
    const mistakeProbability = botMemory.botConfig.humanBehavior.mistakeProbability;
    
    if (Math.random() < mistakeProbability) {
      // Make a mistake - pick randomly
      return availableCards[Math.floor(Math.random() * availableCards.length)];
    }
    
    // Even when not making mistakes, strategy is poor
    if (Math.random() < 0.4 && botMemory.rememberedCards.size > 0) {
      const remembered = availableCards.filter(({ index }) => botMemory.rememberedCards.has(index));
      if (remembered.length > 0) {
        return remembered[Math.floor(Math.random() * remembered.length)];
      }
    }
    
    return availableCards[Math.floor(Math.random() * availableCards.length)];
  }

  // Perfect matching card for winning bots
  static findPerfectMatchingCard(firstCard, availableCards, botMemory, board) {
    const firstCardSymbol = board[firstCard.index].symbol;
    
    // Perfect bots always find the match if they remember it
    for (const [position, symbol] of botMemory.rememberedCards) {
      if (symbol === firstCardSymbol && position !== firstCard.index) {
        const matchCard = availableCards.find(({ index }) => index === position);
        if (matchCard) {
          return matchCard;
        }
      }
    }
    
    // If no match in memory, make strategic choice
    const remainingCards = availableCards.filter(({ index }) => index !== firstCard.index);
    if (remainingCards.length > 0) {
      // Strategic selection for second card
      return this.selectStrategicSecondCard(remainingCards, botMemory, firstCard);
    }
    
    return null;
  }

  // Human-like matching card for normal bots
  static findHumanLikeMatchingCard(firstCard, availableCards, botMemory, board) {
    const firstCardSymbol = board[firstCard.index].symbol;
    const memoryAccuracy = botMemory.botConfig.humanBehavior.memoryAccuracy;
    
    // Try to find match in memory with human-like accuracy
    for (const [position, symbol] of botMemory.rememberedCards) {
      if (symbol === firstCardSymbol && position !== firstCard.index) {
        const matchCard = availableCards.find(({ index }) => index === position);
        if (matchCard && Math.random() < memoryAccuracy) {
          return matchCard;
        }
      }
    }
    
    // If no match found or memory failed, make human-like choice
    const remainingCards = availableCards.filter(({ index }) => index !== firstCard.index);
    if (remainingCards.length > 0) {
      return remainingCards[Math.floor(Math.random() * remainingCards.length)];
    }
    
    return null;
  }

  // Strategic second card selection for winning bots
  static selectStrategicSecondCard(remainingCards, botMemory, firstCard) {
    const intelligence = botMemory.intelligence;
    
    // Different strategies for second card based on intelligence type
    switch (intelligence) {
      case 'strategic':
      case 'analytical':
        // Prefer cards that give maximum information
        const strategicPositions = [0, 4, 5, 9, 10, 14, 15, 19, 20, 24, 25, 29];
        for (const pos of strategicPositions) {
          const card = remainingCards.find(({ index }) => index === pos);
          if (card) return card;
        }
        break;
        
      case 'tactical':
      case 'adaptive':
        // Prefer unexplored cards
        const unexplored = remainingCards.filter(({ index }) => !botMemory.rememberedCards.has(index));
        if (unexplored.length > 0) return unexplored[0];
        break;
        
      default:
        // Default strategic choice
        break;
    }
    
    return remainingCards[0];
  }

  // Enhanced memory update for new bot system
  static updateBotMemory(botMemory, revealedCards, wasSuccessful) {
    const retentionRate = botMemory.isWinningBot ? 
      (wasSuccessful ? 0.98 : 0.95) : // Winning bots have near-perfect memory
      (wasSuccessful ? 
        botMemory.botConfig.humanBehavior.memoryAccuracy : 
        botMemory.botConfig.humanBehavior.memoryAccuracy * 0.7);
    
    // Remember revealed cards based on bot type
    revealedCards.forEach(card => {
      if (botMemory.perfectMemory || Math.random() < retentionRate) {
        botMemory.rememberedCards.set(card.position, card.symbol);
      }
    });
    
    // Winning bots rarely forget, normal bots forget more often
    const forgetRate = botMemory.isWinningBot ? 0.01 : 
      (botMemory.botConfig.humanBehavior.mistakeProbability * 0.2);
    
    if (Math.random() < forgetRate) {
      const positions = Array.from(botMemory.rememberedCards.keys());
      if (positions.length > 0) {
        const forgetPos = positions[Math.floor(Math.random() * positions.length)];
        botMemory.rememberedCards.delete(forgetPos);
      }
    }
  }
}

module.exports = EnhancedBotLogic;