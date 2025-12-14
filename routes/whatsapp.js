const express = require('express');
const twilio = require('twilio');
const { WhatsAppConversation, Incident, ActivityLog } = require('../models');

const router = express.Router();

// Twilio credentials
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);
const fromNumber = process.env.TWILIO_WHATSAPP_FROM;

// Middleware to validate Twilio webhook
const validateTwilioRequest = (req, res, next) => {
  console.log('Validating Twilio webhook...');
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log('TWILIO_AUTH_TOKEN present:', !!process.env.TWILIO_AUTH_TOKEN);

  // Temporarily skip validation to debug webhook calls
  console.log('Skipping validation for debugging');
  return next();

  // Skip validation in development
  if (process.env.NODE_ENV !== 'production') {
    console.log('Skipping validation (development mode)');
    return next();
  }

  // In production, require auth token
  if (!process.env.TWILIO_AUTH_TOKEN) {
    console.error('TWILIO_AUTH_TOKEN not set in production environment');
    return res.status(500).send('Server configuration error');
  }

  const twilioSignature = req.get('X-Twilio-Signature');
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const params = req.body;

  console.log('Twilio signature:', twilioSignature);
  console.log('Request URL:', url);

  if (twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, twilioSignature, url, params)) {
    console.log('Webhook validation successful');
    next();
  } else {
    console.log('Webhook validation failed');
    res.status(403).send('Invalid signature');
  }
};

// Send WhatsApp message
const sendWhatsAppMessage = async (to, body) => {
  try {
    await client.messages.create({
      body,
      from: fromNumber,
      to: `whatsapp:${to}`
    });
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
  }
};

// Handle incoming WhatsApp messages
router.post('/webhook', validateTwilioRequest, async (req, res) => {
  console.log('=== WhatsApp Webhook Called ===');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));

  const { From, Body, MediaUrl0, MediaContentType0 } = req.body;
  const phoneNumber = From.replace('whatsapp:', '');

  try {
    console.log(`WhatsApp message from ${phoneNumber}: ${Body}`);

    // Get or create conversation
    let conversation = await WhatsAppConversation.findOne({ where: { phone_number: phoneNumber } });
    if (!conversation) {
      conversation = await WhatsAppConversation.create({ phone_number: phoneNumber });
      console.log(`New WhatsApp conversation created for ${phoneNumber}`);
    }

    const message = Body.trim().toLowerCase();

    // Handle "Hi" or reset
    if (message === 'hi' || message === 'hello' || message === 'bye') {
      if (message === 'bye') {
        await conversation.update({ state: 'idle', temp_data: {} });
        await sendWhatsAppMessage(phoneNumber, 'Conversation ended. Send "Hi" to start again.');
        return res.status(200).send();
      }

      await conversation.update({ state: 'awaiting_menu_choice', temp_data: {} });
      await sendWhatsAppMessage(phoneNumber, 'Welcome! Enter 1 to report an incident, 2 to check progress on a previous report, 3 to escalate an existing issue.');
      return res.status(200).send();
    }

    // Handle menu choices
    if (conversation.state === 'awaiting_menu_choice') {
      if (message === '1') {
        await conversation.update({ state: 'reporting_incident_title', temp_data: {} });
        await sendWhatsAppMessage(phoneNumber, 'Please enter the incident title:');
      } else if (message === '2') {
        await conversation.update({ state: 'awaiting_report_id' });
        await sendWhatsAppMessage(phoneNumber, 'Please enter your report ID:');
      } else if (message === '3') {
        await conversation.update({ state: 'awaiting_escalation_reason', temp_data: {} });
        await sendWhatsAppMessage(phoneNumber, 'Please enter the report ID you want to escalate:');
      } else {
        await sendWhatsAppMessage(phoneNumber, 'Invalid choice. Please reply with 1, 2, or 3.');
      }
      return res.status(200).send();
    }

    // Handle media attachments
    let mediaUrls = [];
    if (MediaUrl0) {
      mediaUrls.push(MediaUrl0);
      // Handle multiple media if present
      let i = 1;
      while (req.body[`MediaUrl${i}`]) {
        mediaUrls.push(req.body[`MediaUrl${i}`]);
        i++;
      }
    }

    // Update last activity
    await conversation.update({ last_activity: new Date() });

    // Handle incident reporting flow
    if (conversation.state.startsWith('reporting_incident_')) {
      await handleIncidentReporting(conversation, message, phoneNumber, mediaUrls);
    } else if (conversation.state === 'awaiting_report_id') {
      await handleProgressCheck(conversation, message, phoneNumber);
    } else if (conversation.state === 'awaiting_escalation_reason') {
      await handleEscalation(conversation, message, phoneNumber);
    }

    res.status(200).send();
  } catch (error) {
    console.error('Error processing WhatsApp message:', error);
    res.status(500).send();
  }
});

// Handle incident reporting steps
async function handleIncidentReporting(conversation, message, phoneNumber, mediaUrls = []) {
  const tempData = { ...conversation.temp_data };

  switch (conversation.state) {
    case 'reporting_incident_title':
      tempData.title = message;
      await conversation.update({ state: 'reporting_incident_description', temp_data: tempData });
      await sendWhatsAppMessage(phoneNumber, 'Please enter the incident description:');
      break;

    case 'reporting_incident_description':
      tempData.description = message;
      if (mediaUrls.length > 0) {
        tempData.images = tempData.images || [];
        tempData.images.push(...mediaUrls);
      }
      await conversation.update({ state: 'reporting_incident_location', temp_data: tempData });
      await sendWhatsAppMessage(phoneNumber, 'Please enter the location:');
      break;

    case 'reporting_incident_location':
      tempData.location = message;
      await conversation.update({ state: 'reporting_incident_contact_name', temp_data: tempData });
      await sendWhatsAppMessage(phoneNumber, 'Please enter your contact name:');
      break;

    case 'reporting_incident_contact_name':
      tempData.contact_name = message;
      await conversation.update({ state: 'reporting_incident_contact_phone', temp_data: tempData });
      await sendWhatsAppMessage(phoneNumber, 'Please enter your contact phone number:');
      break;

    case 'reporting_incident_contact_phone':
      tempData.contact_phone = message;
      await conversation.update({ state: 'reporting_incident_contact_email', temp_data: tempData });
      await sendWhatsAppMessage(phoneNumber, 'Please enter your contact email (optional, press enter to skip):');
      break;

    case 'reporting_incident_contact_email':
      tempData.contact_email = message || null;
      await conversation.update({ state: 'confirming_incident', temp_data: tempData });
      const summary = `Title: ${tempData.title}\nDescription: ${tempData.description}\nLocation: ${tempData.location}\nContact: ${tempData.contact_name}, ${tempData.contact_phone}${tempData.contact_email ? ', ' + tempData.contact_email : ''}\n\nReply "yes" to confirm or "no" to start over.`;
      await sendWhatsAppMessage(phoneNumber, summary);
      break;

    case 'confirming_incident':
      if (message === 'yes') {
        // Create incident
        const trackingId = 'INC' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase();
        const images = tempData.images ? tempData.images.join(',') : null;
        const incident = await Incident.create({
          title: tempData.title,
          description: tempData.description,
          location: tempData.location,
          contact_name: tempData.contact_name,
          contact_phone: tempData.contact_phone,
          contact_email: tempData.contact_email,
          images,
          tracking_id: trackingId,
          status: 'verified'
        });

        // Log activity
        await ActivityLog.create({
          action: `Incident reported via WhatsApp: ${tempData.title}`,
          table_name: 'incidents',
          reference_id: incident.id,
        });

        // Send notification to managers
        global.sendRoleNotification('manager', 'new-incident', {
          type: 'alert',
          title: 'New Incident Reported via WhatsApp',
          message: `New incident reported: ${tempData.title}`,
          related_type: 'incident',
          related_id: incident.id
        });

        await conversation.update({ state: 'idle', temp_data: {} });
        await sendWhatsAppMessage(phoneNumber, `Incident reported successfully! Your report ID is: ${trackingId}`);
      } else if (message === 'no') {
        await conversation.update({ state: 'reporting_incident_title', temp_data: {} });
        await sendWhatsAppMessage(phoneNumber, 'Let\'s start over. Please enter the incident title:');
      } else {
        await sendWhatsAppMessage(phoneNumber, 'Please reply "yes" to confirm or "no" to start over.');
      }
      break;
  }
}

// Handle progress check
async function handleProgressCheck(conversation, message, phoneNumber) {
  const incident = await Incident.findOne({ where: { tracking_id: message.toUpperCase() } });
  if (!incident) {
    await sendWhatsAppMessage(phoneNumber, 'Report ID not found. Please check and try again.');
  } else {
    const status = `Status: ${incident.status}\nTitle: ${incident.title}\nDescription: ${incident.description}\nLocation: ${incident.location}\nReported: ${incident.created_at.toDateString()}`;
    await sendWhatsAppMessage(phoneNumber, status);
  }
  await conversation.update({ state: 'idle' });
}

// Handle escalation
async function handleEscalation(conversation, message, phoneNumber) {
  const tempData = { ...conversation.temp_data };

  if (!tempData.report_id) {
    const incident = await Incident.findOne({ where: { tracking_id: message.toUpperCase() } });
    if (!incident) {
      await sendWhatsAppMessage(phoneNumber, 'Report ID not found. Please check and try again.');
      await conversation.update({ state: 'idle' });
      return;
    }
    tempData.report_id = message.toUpperCase();
    await conversation.update({ temp_data: tempData });
    await sendWhatsAppMessage(phoneNumber, 'Please enter the reason for escalation:');
  } else {
    // Update incident status to escalated
    await Incident.update(
      { status: 'escalated' },
      { where: { tracking_id: tempData.report_id } }
    );

    // Log escalation
    const incident = await Incident.findOne({ where: { tracking_id: tempData.report_id } });
    await ActivityLog.create({
      action: `Incident escalated via WhatsApp: ${message}`,
      table_name: 'incidents',
      reference_id: incident.id,
    });

    // Notify managers
    global.sendRoleNotification('manager', 'incident-escalated', {
      type: 'alert',
      title: 'Incident Escalated via WhatsApp',
      message: `Incident ${tempData.report_id} escalated: ${message}`,
      related_type: 'incident',
      related_id: incident.id
    });

    await conversation.update({ state: 'idle', temp_data: {} });
    await sendWhatsAppMessage(phoneNumber, 'Issue escalated successfully. Our team will review it shortly.');
  }
}

// Test endpoint to verify webhook is accessible
router.get('/test', (req, res) => {
  res.json({
    message: 'WhatsApp webhook is accessible',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
    authTokenPresent: !!process.env.TWILIO_AUTH_TOKEN
  });
});

module.exports = router;