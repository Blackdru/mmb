const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function createSuperAdmin() {
  try {
    console.log('🔧 Creating superadmin user...');
    
    // Check if superadmin already exists
    const existingSuperAdmin = await prisma.admin.findFirst({
      where: {
        OR: [
          { email: 'ganeshmudiraj7tec@gmail.com' },
          { username: 'Ganesh Mudiraj' },
          { role: 'SuperAdmin' }
        ]
      }
    });

    if (existingSuperAdmin) {
      console.log('✅ SuperAdmin already exists:', existingSuperAdmin.username);
      return existingSuperAdmin;
    }

    // Hash the password
    const password = 'SuperAdmin@2025'; // Strong password for superadmin
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create superadmin user
    const superAdmin = await prisma.admin.create({
      data: {
        username: 'Ganesh Mudiraj',
        email: 'ganeshmudiraj7tec@gmail.com',
        password: hashedPassword,
        role: 'SuperAdmin'
      }
    });

    console.log('✅ SuperAdmin created successfully!');
    console.log('📧 Email:', superAdmin.email);
    console.log('👤 Username:', superAdmin.username);
    console.log('🔑 Password:', password);
    console.log('🛡️ Role:', superAdmin.role);
    console.log('');
    console.log('⚠️  IMPORTANT: Please save these credentials securely!');
    console.log('⚠️  Change the password after first login for security.');

    return superAdmin;

  } catch (error) {
    console.error('❌ Error creating superadmin:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
createSuperAdmin()
  .then(() => {
    console.log('🎉 SuperAdmin setup completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 SuperAdmin setup failed:', error);
    process.exit(1);
  });