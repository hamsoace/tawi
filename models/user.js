const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    unique: true,
  },
  pin: {
    type: String,
    required: true,
  },
  userType: {
    type: String,
    required: true,
    enum: ['admin', 'branchManager', 'dsa', 'retailer']
  },
  recharges: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Recharge'
  }]
});
userSchema.pre('save', async function(next) {
  if (!this.isModified('pin')) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.pin = await bcrypt.hash(this.pin, salt);
    next();
  } catch (error) {
    next(error);
  }
});

userSchema.methods.comparePin = async function(candidatePin) {
  return bcrypt.compare(candidatePin, this.pin);
};

// Add a helper method to the User schema for phone number formatting
userSchema.methods.getFormattedPhone = function(format = 'basic') {
  switch (format) {
    case 'safaricom':
      return `254${this.phone}`;
    case 'kenya':
      return `0${this.phone}`;
    case 'international':
      return `+254${this.phone}`;
    default:
      return this.phone;
  }
};

module.exports = mongoose.model('User', userSchema);