const express = require('express');
const axios = require('axios');
const auth = require('../middleware/auth');

const router = express.Router();

async function getAccessToken() {
  const { CONSUMER_KEY, CONSUMER_SECRET, SAFARICOM_API_URL } = process.env;
  const url = `${SAFARICOM_API_URL}/oauth2/v1/generate?grant_type=client_credentials`;
  
  const credentials = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
  
  try {
    const response = await axios.post(url, null, {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
    });
    return response.data.access_token;
  } catch (error) {
    console.error('Error generating access token:', error);
    throw error;
  }
}

router.post('/', auth, async (req, res) => {
  const { receiverMsisdn, amount, servicePin } = req.body;

  // Validate required fields
  if (!receiverMsisdn || !amount || !servicePin) {
    return res.status(400).json({ 
      success: false, 
      error: 'Missing required fields' 
    });
  }

  if (!req.user || !req.user.phone) {
    return res.status(400).json({
      success: false,
      error: 'Sender phone number not found in token'
    });
  }

  const phoneRegex = /^(?:254|\+254|0)?([7-9]\d{8})$/;
    if (!phoneRegex.test(receiverMsisdn)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid receiver phone number format'
      });
    }

    if (!phoneRegex.test(req.user.phone)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid sender phone number format'
      });
    }


    const formattedReceiverMsisdn = receiverMsisdn.replace(/^(?:254|\+254|0)/, '');
    const formattedSenderMsisdn = req.user.phone.replace(/^(?:254|\+254|0)/, '');


  const token = await getAccessToken();

  console.log('Request payload:', {
    senderMsisdn: formattedSenderMsisdn,
    receiverMsisdn: formattedReceiverMsisdn,
    amount,
    servicePin: Buffer.from(servicePin, 'utf8').toString('base64'),
  });


  try {
    const response = await axios.post(
      `${process.env.SAFARICOM_API_URL}/v1/pretups/api/recharge`,
      {
        senderMsisdn: formattedSenderMsisdn,
        receiverMsisdn: formattedReceiverMsisdn,
        amount,
        servicePin: Buffer.from(servicePin, 'utf8').toString('base64'),
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      }
    );

     const { data } = response;
     const { responseId, responseStatus, transId, responseDesc } = data;
 
     res.json({
       success: true,
       responseId,
       responseStatus,
       transId,
       responseDesc,
     });
  } catch (err) {
    console.error('Recharge error:', err.response?.data || err.message);
    res.status(err.response?.status || 500).json({
      success: false,
      error: err.response?.data?.error || 'Recharge failed',
    });
  }
  
});

module.exports = router;