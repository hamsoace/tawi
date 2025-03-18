// Run this once in a separate script
const User = require('./models/User');
const Recharge = require('./models/Recharge');

async function migrateUserIds() {
  const users = await User.find();
  
  for (const user of users) {
    await Recharge.updateMany(
      { senderMsisdn: user.phone },
      { $set: { userId: user._id } }
    );
  }
}

migrateUserIds().then(() => console.log('Migration complete'));
