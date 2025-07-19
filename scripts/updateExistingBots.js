// Database Migration Script - Update Existing Bots to New 10-Type System
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// New 10 Bot Types Configuration
const BOT_TYPES = {
  // 7 Winning Bot Types (100% win rate)
  winning: [
    'strategic_master',
    'analytical_genius', 
    'tactical_expert',
    'adaptive_champion',
    'intuitive_player',
    'calculated_winner',
    'smart_competitor'
  ],
  // 3 Normal Bot Types (human-like win rates)
  normal: [
    'casual_player',
    'random_player', 
    'beginner_bot'
  ]
};

// Bot type distribution (70% winning, 30% normal)
function selectRandomBotType() {
  const random = Math.random();
  
  if (random < 0.7) {
    // 70% chance for winning bots
    const winningTypes = BOT_TYPES.winning;
    return winningTypes[Math.floor(Math.random() * winningTypes.length)];
  } else {
    // 30% chance for normal bots
    const normalTypes = BOT_TYPES.normal;
    return normalTypes[Math.floor(Math.random() * normalTypes.length)];
  }
}

async function updateExistingBots() {
  try {
    console.log('🤖 Starting bot database migration...');
    
    // Get all existing bots
    const existingBots = await prisma.user.findMany({
      where: {
        isBot: true
      },
      select: {
        id: true,
        name: true,
        botType: true,
        isBot: true
      }
    });

    console.log(`📊 Found ${existingBots.length} existing bots to update`);

    if (existingBots.length === 0) {
      console.log('✅ No existing bots found. Migration complete.');
      return;
    }

    let updatedCount = 0;
    let winningBotsCount = 0;
    let normalBotsCount = 0;

    // Update each bot with new bot type
    for (const bot of existingBots) {
      const newBotType = selectRandomBotType();
      
      try {
        await prisma.user.update({
          where: { id: bot.id },
          data: {
            botType: newBotType
          }
        });

        // Track distribution
        if (BOT_TYPES.winning.includes(newBotType)) {
          winningBotsCount++;
        } else {
          normalBotsCount++;
        }

        updatedCount++;
        console.log(`✅ Updated bot ${bot.name} (${bot.id}) -> ${newBotType}`);
        
      } catch (updateError) {
        console.error(`❌ Failed to update bot ${bot.name} (${bot.id}):`, updateError.message);
      }
    }

    // Summary
    console.log('\n📈 Migration Summary:');
    console.log(`Total bots updated: ${updatedCount}/${existingBots.length}`);
    console.log(`Winning bots: ${winningBotsCount} (${((winningBotsCount/updatedCount)*100).toFixed(1)}%)`);
    console.log(`Normal bots: ${normalBotsCount} (${((normalBotsCount/updatedCount)*100).toFixed(1)}%)`);
    
    // Verify distribution
    const targetWinningPercentage = 70;
    const actualWinningPercentage = (winningBotsCount/updatedCount)*100;
    const deviation = Math.abs(actualWinningPercentage - targetWinningPercentage);
    
    if (deviation <= 10) {
      console.log(`✅ Distribution is within acceptable range (target: 70%, actual: ${actualWinningPercentage.toFixed(1)}%)`);
    } else {
      console.log(`⚠️  Distribution deviation: ${deviation.toFixed(1)}% (target: 70%, actual: ${actualWinningPercentage.toFixed(1)}%)`);
    }

    console.log('\n🎯 Bot Type Breakdown:');
    
    // Count by specific bot type
    const botTypeCounts = {};
    for (const bot of existingBots) {
      const newBotType = await prisma.user.findUnique({
        where: { id: bot.id },
        select: { botType: true }
      });
      
      if (newBotType && newBotType.botType) {
        botTypeCounts[newBotType.botType] = (botTypeCounts[newBotType.botType] || 0) + 1;
      }
    }

    // Display breakdown
    console.log('\nWinning Bot Types:');
    BOT_TYPES.winning.forEach(type => {
      const count = botTypeCounts[type] || 0;
      console.log(`  ${type}: ${count} bots`);
    });

    console.log('\nNormal Bot Types:');
    BOT_TYPES.normal.forEach(type => {
      const count = botTypeCounts[type] || 0;
      console.log(`  ${type}: ${count} bots`);
    });

    console.log('\n✅ Bot migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Additional function to clean up old bot data
async function cleanupOldBotData() {
  try {
    console.log('\n🧹 Cleaning up old bot data...');
    
    // Remove any bots with invalid or old bot types
    const invalidBots = await prisma.user.findMany({
      where: {
        isBot: true,
        OR: [
          { botType: null },
          { botType: '' },
          { 
            botType: {
              notIn: [...BOT_TYPES.winning, ...BOT_TYPES.normal]
            }
          }
        ]
      }
    });

    if (invalidBots.length > 0) {
      console.log(`Found ${invalidBots.length} bots with invalid bot types`);
      
      for (const bot of invalidBots) {
        const newBotType = selectRandomBotType();
        await prisma.user.update({
          where: { id: bot.id },
          data: { botType: newBotType }
        });
        console.log(`🔧 Fixed bot ${bot.name} -> ${newBotType}`);
      }
    } else {
      console.log('✅ No invalid bot types found');
    }

  } catch (error) {
    console.error('❌ Cleanup failed:', error);
  }
}

// Function to create additional bots if needed
async function ensureMinimumBots(minCount = 20) {
  try {
    console.log(`\n🔢 Ensuring minimum ${minCount} bots exist...`);
    
    const currentBotCount = await prisma.user.count({
      where: { isBot: true }
    });

    console.log(`Current bot count: ${currentBotCount}`);

    if (currentBotCount < minCount) {
      const botsToCreate = minCount - currentBotCount;
      console.log(`Creating ${botsToCreate} additional bots...`);

      // Bot names pool
      const botNames = [
        'NareshMj', 'Siddharth', 'Ganesh', 'Aditya', 'Krishna', 'Ramakrishna',
        'Ritesh', 'Arjun', 'Veerendra', 'Mahesh', 'Sandeep', 'Narayan',
        'Vijay', 'Yashwanth', 'Abhishek', 'Rajeev', 'Vijaya', 'Chetan',
        'Vivek', 'Suresh', 'Veera', 'Praveen', 'Raghav', 'Vikas',
        'Ankit', 'Kalyan', 'Vishal', 'Dinesh', 'Kiran', 'Jayanthi',
        'Uday', 'Harshad', 'Bala', 'Nagaraju', 'Aman', 'Nikhil',
        'Swamycharan', 'Varun', 'Chandan', 'Pawan', 'Jagadeesh', 'Prasad',
        'Amarnath', 'Srinivas', 'Vinay', 'Tejaswi', 'Veerabhadra', 'Karthik',
        'Satya', 'Gopal', 'Ravi', 'Mohan', 'Deepak', 'Rajesh',
        'Sunil', 'Ashok', 'Pradeep', 'Manoj', 'Rohit', 'Vikram'
      ];

      for (let i = 0; i < botsToCreate; i++) {
        const botType = selectRandomBotType();
        const randomName = botNames[Math.floor(Math.random() * botNames.length)];
        const uniqueId = Math.floor(Math.random() * 999) + 1;
        const botName = `${randomName}${uniqueId}`;
        const botPhone = `+91${Math.floor(Math.random() * 9000000000) + 1000000000}`;

        try {
          const newBot = await prisma.user.create({
            data: {
              phoneNumber: botPhone,
              name: botName,
              isVerified: true,
              isBot: true,
              botType: botType,
              wallet: {
                create: {
                  balance: 1000,
                  gameBalance: 1000,
                  withdrawableBalance: 0
                }
              }
            }
          });

          console.log(`✅ Created new bot: ${botName} (${botType})`);
        } catch (createError) {
          console.error(`❌ Failed to create bot ${botName}:`, createError.message);
        }
      }
    } else {
      console.log('✅ Sufficient bots already exist');
    }

  } catch (error) {
    console.error('❌ Failed to ensure minimum bots:', error);
  }
}

// Function to verify bot distribution
async function verifyBotDistribution() {
  try {
    console.log('\n📊 Verifying final bot distribution...');
    
    const allBots = await prisma.user.findMany({
      where: { isBot: true },
      select: { botType: true, name: true }
    });

    const distribution = {
      winning: 0,
      normal: 0,
      total: allBots.length
    };

    const typeBreakdown = {};

    allBots.forEach(bot => {
      if (BOT_TYPES.winning.includes(bot.botType)) {
        distribution.winning++;
      } else if (BOT_TYPES.normal.includes(bot.botType)) {
        distribution.normal++;
      }

      typeBreakdown[bot.botType] = (typeBreakdown[bot.botType] || 0) + 1;
    });

    console.log(`\nFinal Distribution:`);
    console.log(`Total bots: ${distribution.total}`);
    console.log(`Winning bots: ${distribution.winning} (${((distribution.winning/distribution.total)*100).toFixed(1)}%)`);
    console.log(`Normal bots: ${distribution.normal} (${((distribution.normal/distribution.total)*100).toFixed(1)}%)`);

    console.log(`\nDetailed Breakdown:`);
    Object.entries(typeBreakdown).forEach(([type, count]) => {
      const category = BOT_TYPES.winning.includes(type) ? 'WINNING' : 'NORMAL';
      console.log(`  ${type}: ${count} bots (${category})`);
    });

    return distribution;
  } catch (error) {
    console.error('❌ Failed to verify distribution:', error);
  }
}

// Main migration function
async function runMigration() {
  try {
    console.log('🚀 Starting Complete Bot Database Migration\n');
    
    // Step 1: Update existing bots
    await updateExistingBots();
    
    // Step 2: Clean up any invalid data
    await cleanupOldBotData();
    
    // Step 3: Ensure minimum bot count (optional)
    await ensureMinimumBots(20);
    
    // Step 4: Verify final distribution
    await verifyBotDistribution();
    
    console.log('\n🎉 Migration completed successfully!');
    console.log('All bots have been updated to the new 10-type system.');
    console.log('Your app is now ready for release with the enhanced bot system.');
    
  } catch (error) {
    console.error('\n💥 Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration if this script is executed directly
if (require.main === module) {
  runMigration();
}

module.exports = {
  updateExistingBots,
  cleanupOldBotData,
  ensureMinimumBots,
  verifyBotDistribution,
  runMigration
};