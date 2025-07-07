const prisma = require('./src/config/database');
const walletService = require('./src/services/walletService');
const logger = require('./src/config/logger');

async function testWalletFixes() {
  try {
    console.log('🧪 Testing Wallet Fixes...\n');
    
    // Test user ID (you can change this to an existing user)
    const testUserId = 'test-user-' + Date.now();
    
    // 1. Test deposit
    console.log('1. Testing deposit...');
    const depositResult = await walletService.creditWallet(testUserId, 100, 'DEPOSIT', null, 'Test deposit');
    console.log('Deposit result:', depositResult);
    
    // 2. Check balance
    console.log('\n2. Checking balance after deposit...');
    const balanceAfterDeposit = await walletService.getWalletBalance(testUserId);
    console.log('Balance after deposit:', balanceAfterDeposit);
    
    // 3. Test game entry deduction
    console.log('\n3. Testing game entry deduction...');
    const gameId = 'test-game-' + Date.now();
    const entryResult = await walletService.deductGameEntry(testUserId, 50, gameId);
    console.log('Entry deduction result:', entryResult);
    
    // 4. Check balance after entry
    console.log('\n4. Checking balance after game entry...');
    const balanceAfterEntry = await walletService.getWalletBalance(testUserId);
    console.log('Balance after entry:', balanceAfterEntry);
    
    // 5. Test game winning
    console.log('\n5. Testing game winning...');
    const winningResult = await walletService.creditWallet(testUserId, 80, 'GAME_WINNING', gameId, 'Test game winning');
    console.log('Winning result:', winningResult);
    
    // 6. Final balance check
    console.log('\n6. Final balance check...');
    const finalBalance = await walletService.getWalletBalance(testUserId);
    console.log('Final balance:', finalBalance);
    
    // 7. Test duplicate entry prevention
    console.log('\n7. Testing duplicate entry prevention...');
    const duplicateEntryResult = await walletService.deductGameEntry(testUserId, 50, gameId);
    console.log('Duplicate entry result:', duplicateEntryResult);
    
    // 8. Test mixed balance deduction
    console.log('\n8. Testing mixed balance deduction (gameBalance + withdrawableBalance)...');
    const mixedEntryResult = await walletService.deductGameEntry(testUserId, 75, 'test-game-2-' + Date.now());
    console.log('Mixed balance deduction result:', mixedEntryResult);
    
    // 9. Final balance after mixed deduction
    console.log('\n9. Final balance after mixed deduction...');
    const finalMixedBalance = await walletService.getWalletBalance(testUserId);
    console.log('Final mixed balance:', finalMixedBalance);
    
    console.log('\n✅ Wallet tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testWalletFixes();