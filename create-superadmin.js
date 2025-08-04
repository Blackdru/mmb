const bcrypt = require('bcryptjs');
const prisma = require('./src/config/database');

async function createSuperAdmin() {
  try {
    console.log('Creating superadmin user...');
    
    // Check if superadmin already exists
    const existingSuperAdmin = await prisma.admin.findFirst({
      where: { role: 'superadmin' }
    });
    
    if (existingSuperAdmin) {
      console.log('✅ Superadmin already exists:');
      console.log(`Username: ${existingSuperAdmin.username}`);
      console.log(`Email: ${existingSuperAdmin.email}`);
      console.log(`Role: ${existingSuperAdmin.role}`);
      return;
    }
    
    // Create superadmin
    const hashedPassword = await bcrypt.hash('superadmin123', 12);
    
    const superAdmin = await prisma.admin.create({
      data: {
        username: 'superadmin',
        email: 'superadmin@budzee.com',
        password: hashedPassword,
        role: 'superadmin'
      }
    });
    
    console.log('✅ Superadmin created successfully!');
    console.log('Username: superadmin');
    console.log('Password: superadmin123');
    console.log('Email: superadmin@budzee.com');
    console.log('Role: superadmin');
    console.log('');
    console.log('🔐 SUPERADMIN PRIVILEGES:');
    console.log('- Full system access');
    console.log('- Can create/edit/delete other admins');
    console.log('- Can access Administration section');
    console.log('- Can reset passwords');
    console.log('- Can manage system settings');
    console.log('');
    console.log('⚠️  IMPORTANT: Please change the default password after first login!');
    
    // List all admins
    const allAdmins = await prisma.admin.findMany({
      select: {
        username: true,
        email: true,
        role: true,
        createdAt: true
      }
    });
    
    console.log('');
    console.log('📋 All Admin Users:');
    allAdmins.forEach(admin => {
      console.log(`- ${admin.username} (${admin.role}) - ${admin.email}`);
    });
    
  } catch (error) {
    console.error('Error creating superadmin:', error);
    
    if (error.code === 'P2002') {
      console.log('Superadmin with this username or email already exists');
    }
  } finally {
    await prisma.$disconnect();
  }
}

createSuperAdmin();