const mongoose = require('mongoose');

const rechargeSchema = new mongoose.Schema({
  senderMsisdn: {
    type: String,
    required: true
  },
  receiverMsisdn: {
    type: String,
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  transactionId: {
    type: String,
    required: true,
    unique: true
  },
  status: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Recharge', rechargeSchema);