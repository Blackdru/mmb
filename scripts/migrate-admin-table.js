const { execSync } = require('child_process');
const path = require('path');

// Function to run Prisma migration
function runMigration() {
  try {
    console.log('Running Prisma migration...');
    
    // Change to the directory where prisma schema is located
    const projectRoot = path.resolve(__dirname, '..');
    process.chdir(projectRoot);
    
    // Create migration
    execSync('npx prisma migrate dev --name add_admin_table', { stdio: 'inherit' });
    
    console.log('✅ Migration completed successfully');
    
    // Run the script to create admin user
    console.log('Creating admin user...');
    require('./create-admin');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
  }
}

runMigration();