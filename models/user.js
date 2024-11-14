const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    unique: true,
  },
  pin: {
    type: String,
    required: true,
  },
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


module.exports = mongoose.model('User', userSchema);