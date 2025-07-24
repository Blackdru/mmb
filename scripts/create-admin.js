const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function createAdmin() {
  try {
    // Hash the password
    const hashedPassword = await bcrypt.hash('Gani77$@#', 10);
    
    // Check if admin already exists
    const existingAdmin = await prisma.admin.findUnique({
      where: { email: 'ganeshmudiraj7tec@gmail.com' }
    });
    
    if (existingAdmin) {
      console.log('Admin user already exists:', existingAdmin.username);
      return;
    }
    
    // Create the admin user
    const admin = await prisma.admin.create({
      data: {
        username: 'Ganesh Mudiraj',
        email: 'ganeshmudiraj7tec@gmail.com',
        password: hashedPassword,
        role: 'SuperAdmin'
      }
    });
    
    console.log('✅ Admin user created successfully:', admin.username);
  } catch (error) {
    console.error('❌ Error creating admin user:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Execute if this script is run directly
if (require.main === module) {
  createAdmin();
}

module.exports = { createAdmin };