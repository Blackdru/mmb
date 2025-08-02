const bcrypt = require('bcryptjs');
const prisma = require('./src/config/database');

async function setupAdmin() {
  try {
    console.log('Setting up admin user...');
    
    // Check if admin table exists and has any records
    const existingAdmins = await prisma.admin.findMany();
    
    if (existingAdmins.length > 0) {
      console.log('Admin users already exist:');
      existingAdmins.forEach(admin => {
        console.log(`- ${admin.username} (${admin.role})`);
      });
      return;
    }
    
    // Create default superadmin
    const hashedPassword = await bcrypt.hash('admin123', 12);
    
    const superAdmin = await prisma.admin.create({
      data: {
        username: 'superadmin',
        email: 'admin@budzee.com',
        password: hashedPassword,
        role: 'superadmin'
      }
    });
    
    console.log('✅ Superadmin created successfully!');
    console.log('Username: superadmin');
    console.log('Password: admin123');
    console.log('Email: admin@budzee.com');
    console.log('Role: superadmin');
    console.log('');
    console.log('⚠️  IMPORTANT: Please change the default password after first login!');
    
    // Create a regular admin for testing
    const regularAdminPassword = await bcrypt.hash('admin456', 12);
    
    const regularAdmin = await prisma.admin.create({
      data: {
        username: 'admin',
        email: 'admin2@budzee.com',
        password: regularAdminPassword,
        role: 'admin'
      }
    });
    
    console.log('');
    console.log('✅ Regular admin created successfully!');
    console.log('Username: admin');
    console.log('Password: admin456');
    console.log('Email: admin2@budzee.com');
    console.log('Role: admin');
    
  } catch (error) {
    console.error('Error setting up admin:', error);
    
    if (error.code === 'P2002') {
      console.log('Admin with this username or email already exists');
    }
  } finally {
    await prisma.$disconnect();
  }
}

setupAdmin();