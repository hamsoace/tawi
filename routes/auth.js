const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/user');
const auth = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { phone, pin } = req.body;

  try {
    if (!phone || !pin){
      return res.status(400).json({
        success: false,
        error: 'Phone and PIN are required'
      });
    }
    const formattedPhone = phone.replace(/^(0|\+254|254)/, '');
    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid phone or PIN'
      });
    }

    const isValidPin = await user.comparePin(pin);
    if (!isValidPin) {
      return res.status(401).json({
        success: false,
        error: 'Invalid phone or PIN'
      });
    }

    const token = jwt.sign(
      { userId: user._id,
        phone: user.formattedPhone
       },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.status(201).json({
      success: true,
      token,
      user: {
        phone: user.phone
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Error logging in' 
    });
  }
});

router.post('/register', async (req, res) => {
    const { phone, pin } = req.body;
  
    try {
      if (!phone || !pin) {
        return res.status(400).json({
          success: false,
          error: 'Phone and PIN are required'
        });
      }

      if (!/^\d{4}$/.test(pin)) {
        return res.status(400).json({
          success: false,
          error: 'PIN must be 4 digits'
        });
      }

      const existingUser = await User.findOne({ phone });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          error: 'Phone number already registered'
        });
      }

      const user = new User({ phone, pin });
      await user.save();

      const token = jwt.sign(
        { userId: user._id,
          phone: user.phone
         },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      res.status(201).json({
        success:true,
        token,
        user: {
          phone: user.phone
        }
      });

    } catch (err) {
      console.error('Error registering user:', err);
      res.status(500).json({ success: false, error: 'Error registering user' });
    }
  });

router.post('/change-pin', auth, async (req, res) => {
  const { currentPin, newPin } = req.body;

  try {
    // Input validation
    if (!currentPin || !newPin) {
      return res.status(400).json({
        success: false,
        error: 'Current PIN and new PIN are required'
      });
    }

    // Validate new PIN format
    if (!/^\d{4}$/.test(newPin)) {
      return res.status(400).json({
        success: false,
        error: 'New PIN must be 4 digits'
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    console.log('User from req:', req.user);

    
    // Verify current PIN
    const isValidPin = await user.comparePin(currentPin);
    if (!isValidPin) {
      return res.status(401).json({
        success: false,
        error: 'Current PIN is incorrect'
      });
    }

    // Update PIN (will be hashed by pre-save middleware)
    user.pin = newPin;
    await user.save();

    res.status(201).json({
      success: true,
      message: 'PIN updated successfully'
    });
  } catch (err) {
    console.error('Change PIN error:', err);
    res.status(500).json({
      success: false,
      error: 'Error changing PIN'
    });
  }
});

module.exports = router;