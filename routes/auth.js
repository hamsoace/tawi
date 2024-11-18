const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/user');
const auth = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { phone, pin } = req.body;

  try {
    if (!phone || !pin) {
      return res.status(400).json({
        success: false,
        error: 'Phone and PIN are required'
      });
    }

    // Normalize phone number by removing any non-digit characters and prefix
    const normalizePhone = (phoneNumber) => {
      // Remove any non-digit characters
      let cleaned = phoneNumber.replace(/\D/g, '');
      // Remove leading 0, +254, or 254
      cleaned = cleaned.replace(/^(0|\+254|254)/, '');
      return cleaned;
    };

    const normalizedInputPhone = normalizePhone(phone);

    // Find user with any variation of the phone number
    const user = await User.findOne({
      $or: [
        { phone: normalizedInputPhone },
        { phone: `0${normalizedInputPhone}` },
        { phone: `254${normalizedInputPhone}` },
        { phone: `+254${normalizedInputPhone}` }
      ]
    });

    if (!user) {
      console.log('No user found for phone variations:', {
        normalized: normalizedInputPhone,
        original: phone
      });
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

    // Use getFormattedPhone to store the safaricom format in the token
    const formattedPhone = user.getFormattedPhone('safaricom');

    const token = jwt.sign(
      { 
        userId: user._id,
        phone: formattedPhone  // Store the Safaricom format (254...)
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.status(201).json({
      success: true,
      token,
      user: {
        phone: formattedPhone
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
  try {
    const { phone, pin } = req.body;

    if (!phone || !pin) {
      return res.status(400).json({
        success: false,
        error: 'Phone and PIN are required'
      });
    }

    // Normalize phone number
    const normalizePhone = (phoneNumber) => {
      let cleaned = phoneNumber.replace(/\D/g, '');
      cleaned = cleaned.replace(/^(0|\+254|254)/, '');
      return cleaned;
    };

    const normalizedPhone = normalizePhone(phone);

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [
        { phone: normalizedPhone },
        { phone: `0${normalizedPhone}` },
        { phone: `254${normalizedPhone}` },
        { phone: `+254${normalizedPhone}` }
      ]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'User already exists with this phone number'
      });
    }

    // Create new user with normalized phone
    const user = new User({
      phone: normalizedPhone,
      pin
    });

    await user.save();

    // Use getFormattedPhone to get the Safaricom format
    const formattedPhone = user.getFormattedPhone('safaricom');

    // Create token with formatted phone
    const token = jwt.sign(
      { 
        userId: user._id,
        phone: formattedPhone
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: {
        phone: formattedPhone
      }
    });

  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({
      success: false,
      error: 'Error registering user'
    });
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