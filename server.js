const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const authRouter = require('./routes/auth');
const rechargeRouter = require('./routes/recharge');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;



mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 60000
})
.then(() => {
  console.log('Connected to MongoDB');
})
.catch((err) => {
  console.error('Error connecting to MongoDB:', err);
  process.exit(1); 
});

app.use(express.json());
app.use('/api/auth', authRouter);
app.use('/api/recharge', rechargeRouter);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});