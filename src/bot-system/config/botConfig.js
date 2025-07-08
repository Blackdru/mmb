// Bot System Configuration

module.exports = {
  // Bot Pool Configuration
  pool: {
    minBots: 20,                    // Minimum number of bots to maintain
    maxBots: 100,                    // Maximum number of bots allowed
    maintenanceInterval: 120000,    // 2 minutes - Bot cleanup interval
  },

  // Bot Deployment Configuration
  deployment: {
    deploymentDelay: 30000,         // 30 seconds - Delay before deploying bot to queue
    checkInterval: 5000,            // 5 seconds - How often to check for bot deployment
  },

  // Bot Player Configuration
  player: {
    initialBalance: 1000,           // Starting balance for new bots (₹1000)
    minBalance: 100,                // Minimum balance before replenishment
    replenishAmount: 1000,          // Amount to add when replenishing
    names: [
      'NareshMj',
'Rajeev',
'Siddharth',
'Swamycharan',
'Raghav',
'Varun',
'Ganesh',
'Nikhil',
'Ritesh',
'Aman',
'Mahesh',
'Vikas',
'Ankit',
'Abhishek',
'Balaji',
'Vishal',
'Vivek',
'Praveen',
'Kiran',
'Dinesh',
'Harshad',
'Bala',
'Chandan',
'Chetan',
'Pawan',
'Jagadeesh',
'Tejaswi',
'Veerendra',
'Ramakrishna',
'Aditya',
'Srinivas',
'Vinay',
'Yashwanth',
'Jayanthi',
'Arjun',
'Krishna',
'Suresh',
'Nagaraju',
'Vijaya',
'Uday',
'Sandeep',
'Karthik',
'Prasad',
'Veera',
'Narayan',
'Kalyan',
'Satya',
'Amarnath',
'Veerabhadra',
'Vijay',
'Gopal'
    ]
  },

  // Bot Gameplay Configuration
  gameplay: {
    memory: {
      turnDelay: 1500,              // 1.5 seconds - Delay before bot starts turn
      cardSelectionDelay: 2000,     // 2 seconds - Delay between first and second card
      difficultyLevels: {
        easy: {
          memoryChance: 0,          // 0% chance to use memory
          perfectRecall: false
        },
        medium: {
          memoryChance: 0.5,        // 50% chance to use memory
          perfectRecall: false
        },
        hard: {
          memoryChance: 1.0,        // 100% chance to use memory
          perfectRecall: true
        }
      }
    }
  },

  // Bot Cleanup Configuration
  cleanup: {
    inactiveThreshold: 3600000,     // 1 hour - Time before bot is considered inactive
    cleanupBatchSize: 10,           // Number of bots to cleanup at once
  },

  // Development Configuration
  development: {
    enableManualDeployment: true,   // Allow manual bot deployment via API
    debugLogging: true,             // Enable detailed bot logging
  },

  // Game-specific Bot Configuration
  games: {
    memory: {
      enabled: true,
      difficulty: 'easy',           // Default difficulty for memory game bots
    },
    // Future games can be added here
    ludo: {
      enabled: false,
      difficulty: 'medium',
    }
  }
};