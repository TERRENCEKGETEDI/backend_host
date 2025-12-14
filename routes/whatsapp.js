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

  const { From, Body, MediaUrl0, MediaContentType0, Latitude, Longitude } = req.body;
  const phoneNumber = From.replace('whatsapp:', '');

  try {
    console.log(`WhatsApp message from ${phoneNumber}: ${Body}`);

    // Get or create conversation
    let conversation = await WhatsAppConversation.findOne({ where: { phone_number: phoneNumber } });
    if (!conversation) {
      conversation = await WhatsAppConversation.create({ phone_number: phoneNumber });
      console.log(`New WhatsApp conversation created for ${phoneNumber}`);
    }

    const message = Body ? Body.trim() : '';
    const hasMedia = !!MediaUrl0;
    const hasLocation = !!(Latitude && Longitude);

    // Handle "Hi" or reset
    if (message.toLowerCase() === 'hi' || message.toLowerCase() === 'hello') {
      await showMainMenu(conversation, phoneNumber);
      return res.status(200).send();
    }

    // Update last activity
    await conversation.update({ last_activity: new Date() });

    // Route to appropriate handler based on state
    switch (conversation.state) {
      case 'idle':
        // Any message when idle starts a new conversation
        await showMainMenu(conversation, phoneNumber);
        break;
      case 'main_menu':
        await handleMainMenuChoice(conversation, message, phoneNumber);
        break;
      case 'selecting_incident_type':
        await handleIncidentTypeSelection(conversation, message, phoneNumber);
        break;
      case 'awaiting_incident_photo':
        await handleIncidentPhoto(conversation, message, phoneNumber, hasMedia ? MediaUrl0 : null);
        break;
      case 'awaiting_location':
        await handleLocationInput(conversation, message, phoneNumber, hasLocation ? { lat: Latitude, lng: Longitude } : null);
        break;
      case 'awaiting_name':
        await handleNameInput(conversation, message, phoneNumber);
        break;
      case 'confirming_incident':
        await handleIncidentConfirmation(conversation, message, phoneNumber);
        break;
      case 'awaiting_progress_id':
        await handleProgressCheck(conversation, message, phoneNumber);
        break;
      case 'awaiting_escalation_id':
        await handleEscalationId(conversation, message, phoneNumber);
        break;
      case 'awaiting_escalation_reason':
        await handleEscalationReason(conversation, message, phoneNumber);
        break;
      case 'confirming_escalation':
        await handleEscalationConfirmation(conversation, message, phoneNumber);
        break;
      default:
        // Unknown state, show main menu
        await showMainMenu(conversation, phoneNumber);
    }

    res.status(200).send();
  } catch (error) {
    console.error('Error processing WhatsApp message:', error);
    res.status(500).send();
  }
});

// Show main menu
async function showMainMenu(conversation, phoneNumber) {
  await conversation.update({ state: 'main_menu', temp_data: {} });
  const menu = `Welcome to Sewage Management System
Enter the number before the option you want, eg "1" to report
1-Report incident
2-Check Progress Status
3-Escalate an Incident
4-Cancel/Exit`;
  await sendWhatsAppMessage(phoneNumber, menu);
}

// Handle main menu choice
async function handleMainMenuChoice(conversation, message, phoneNumber) {
  const choice = message.trim();

  switch (choice) {
    case '1':
      await showIncidentTypes(conversation, phoneNumber);
      break;
    case '2':
      await conversation.update({ state: 'awaiting_progress_id' });
      await sendWhatsAppMessage(phoneNumber, 'Enter the incident ID or reference number to check status');
      break;
    case '3':
      await conversation.update({ state: 'awaiting_escalation_id' });
      await sendWhatsAppMessage(phoneNumber, 'Enter the incident ID to escalate');
      break;
    case '4':
      await conversation.update({ state: 'idle', temp_data: {} });
      await sendWhatsAppMessage(phoneNumber, 'Session ended. Thank you for using Sewage Management System.');
      break;
    default:
      await sendWhatsAppMessage(phoneNumber, 'Invalid input, please try again. Enter 1, 2, 3, or 4.');
  }
}

// Show incident type selection
async function showIncidentTypes(conversation, phoneNumber) {
  await conversation.update({ state: 'selecting_incident_type' });
  const types = `Select the Incident below:
1-Sewage Leak
2-Road Damage
3-Water Main Break
4-Storm Drain Issue
5-Manhole Problem
6-Other`;
  await sendWhatsAppMessage(phoneNumber, types);
}

// Handle incident type selection
async function handleIncidentTypeSelection(conversation, message, phoneNumber) {
  const incidentTypes = {
    '1': 'Sewage Leak',
    '2': 'Road Damage',
    '3': 'Water Main Break',
    '4': 'Storm Drain Issue',
    '5': 'Manhole Problem',
    '6': 'Other'
  };

  const type = incidentTypes[message.trim()];
  if (!type) {
    await sendWhatsAppMessage(phoneNumber, 'Invalid input, please try again. Enter 1-6.');
    return;
  }

  const tempData = { ...conversation.temp_data, incident_type: type };
  await conversation.update({ state: 'awaiting_incident_photo', temp_data: tempData });
  await sendWhatsAppMessage(phoneNumber, 'Please send a photo of the area and add a description/caption (not a must) along with the picture');
}

// Handle incident photo and description
async function handleIncidentPhoto(conversation, message, phoneNumber, mediaUrl) {
  if (!mediaUrl) {
    await sendWhatsAppMessage(phoneNumber, 'Please send a photo of the incident area.');
    return;
  }

  const tempData = {
    ...conversation.temp_data,
    image: mediaUrl,
    description: message || 'No description provided'
  };

  await conversation.update({ state: 'awaiting_location', temp_data: tempData });
  await sendWhatsAppMessage(phoneNumber, 'Please send the location of the incident (share location or describe it)');
}

// Handle location input
async function handleLocationInput(conversation, message, phoneNumber, locationData) {
  let location = '';

  if (locationData) {
    // WhatsApp location shared
    location = `${locationData.lat},${locationData.lng}`;
  } else if (message && message.toLowerCase() !== 'skip') {
    // Text description
    location = message;
  } else {
    await sendWhatsAppMessage(phoneNumber, 'Location is required. Please share your location or describe it.');
    return;
  }

  const tempData = { ...conversation.temp_data, location };
  await conversation.update({ state: 'awaiting_name', temp_data: tempData });
  await sendWhatsAppMessage(phoneNumber, 'Enter your name (not a must, enter "skip" to skip)');
}

// Handle name input
async function handleNameInput(conversation, message, phoneNumber) {
  const name = message.toLowerCase() === 'skip' ? null : message || null;
  const tempData = { ...conversation.temp_data, name };

  await conversation.update({ state: 'confirming_incident', temp_data: tempData });
  await showIncidentSummary(conversation, phoneNumber);
}

// Show incident summary for confirmation
async function showIncidentSummary(conversation, phoneNumber) {
  const data = conversation.temp_data;
  const summary = `Incident Summary:
Type: ${data.incident_type}
Description: ${data.description}
Location: ${data.location}
Name: ${data.name || 'Not provided'}

Enter "Y" to confirm or "N" to cancel`;
  await sendWhatsAppMessage(phoneNumber, summary);
}

// Handle incident confirmation
async function handleIncidentConfirmation(conversation, message, phoneNumber) {
  const choice = message.toLowerCase().trim();

  if (choice === 'y' || choice === 'yes') {
    await createIncident(conversation, phoneNumber);
  } else if (choice === 'n' || choice === 'no') {
    await conversation.update({ state: 'idle', temp_data: {} });
    await sendWhatsAppMessage(phoneNumber, 'Incident report cancelled.');
    await showMainMenu(conversation, phoneNumber);
  } else {
    await sendWhatsAppMessage(phoneNumber, 'Invalid input. Enter "Y" to confirm or "N" to cancel.');
  }
}

// Create incident in database
async function createIncident(conversation, phoneNumber) {
  const data = conversation.temp_data;

  try {
    // Create incident
    const trackingId = 'INC' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase();
    const incident = await Incident.create({
      title: data.incident_type,
      description: data.description,
      location: data.location,
      contact_name: data.name,
      images: data.image,
      tracking_id: trackingId,
      status: 'verified'
    });

    // Log activity
    await ActivityLog.create({
      action: `Incident reported via WhatsApp: ${data.incident_type}`,
      table_name: 'incidents',
      reference_id: incident.id,
    });

    // Send notification to managers
    global.sendRoleNotification('manager', 'new-incident', {
      type: 'alert',
      title: 'New Incident Reported via WhatsApp',
      message: `New incident reported: ${data.incident_type}`,
      related_type: 'incident',
      related_id: incident.id
    });

    await conversation.update({ state: 'idle', temp_data: {} });
    await sendWhatsAppMessage(phoneNumber, `✅ Incident reported successfully! Your reference number is: ${trackingId}`);
    await showMainMenu(conversation, phoneNumber);
  } catch (error) {
    console.error('Error creating incident:', error);
    await sendWhatsAppMessage(phoneNumber, 'Sorry, there was an error processing your report. Please try again.');
    await showMainMenu(conversation, phoneNumber);
  }
}

// Handle progress check
async function handleProgressCheck(conversation, message, phoneNumber) {
  const incidentId = message.trim().toUpperCase();
  const incident = await Incident.findOne({ where: { tracking_id: incidentId } });

  if (!incident) {
    await sendWhatsAppMessage(phoneNumber, 'Invalid ID, please enter a valid incident ID');
    return;
  }

  const status = `Incident ID ${incidentId}: Reported on ${incident.created_at.toDateString()}, Status: ${incident.status}, Last Update: ${incident.updated_at.toDateString()}`;
  await sendWhatsAppMessage(phoneNumber, status);
  await showMainMenu(conversation, phoneNumber);
}

// Handle escalation ID input
async function handleEscalationId(conversation, message, phoneNumber) {
  const incidentId = message.trim().toUpperCase();
  const incident = await Incident.findOne({ where: { tracking_id: incidentId } });

  if (!incident) {
    await sendWhatsAppMessage(phoneNumber, 'Invalid ID, please enter a valid incident ID');
    return;
  }

  const tempData = { ...conversation.temp_data, escalation_id: incidentId };
  await conversation.update({ state: 'awaiting_escalation_reason', temp_data: tempData });
  await sendWhatsAppMessage(phoneNumber, 'Provide reason for escalation (optional description, enter "skip" to skip)');
}

// Handle escalation reason
async function handleEscalationReason(conversation, message, phoneNumber) {
  const reason = message.toLowerCase() === 'skip' ? 'No reason provided' : message;
  const tempData = { ...conversation.temp_data, escalation_reason: reason };

  await conversation.update({ state: 'confirming_escalation', temp_data: tempData });
  await showEscalationSummary(conversation, phoneNumber);
}

// Show escalation summary
async function showEscalationSummary(conversation, phoneNumber) {
  const data = conversation.temp_data;
  const summary = `Escalation Summary:
Incident ID: ${data.escalation_id}
Reason: ${data.escalation_reason}

Enter "Y" to confirm or "N" to cancel`;
  await sendWhatsAppMessage(phoneNumber, summary);
}

// Handle escalation confirmation
async function handleEscalationConfirmation(conversation, message, phoneNumber) {
  const choice = message.toLowerCase().trim();

  if (choice === 'y' || choice === 'yes') {
    await escalateIncident(conversation, phoneNumber);
  } else if (choice === 'n' || choice === 'no') {
    await conversation.update({ state: 'idle', temp_data: {} });
    await sendWhatsAppMessage(phoneNumber, 'Escalation cancelled.');
    await showMainMenu(conversation, phoneNumber);
  } else {
    await sendWhatsAppMessage(phoneNumber, 'Invalid input. Enter "Y" to confirm or "N" to cancel.');
  }
}

// Escalate incident
async function escalateIncident(conversation, phoneNumber) {
  const data = conversation.temp_data;

  try {
    // Update incident status
    await Incident.update(
      { status: 'escalated' },
      { where: { tracking_id: data.escalation_id } }
    );

    // Log escalation
    const incident = await Incident.findOne({ where: { tracking_id: data.escalation_id } });
    await ActivityLog.create({
      action: `Incident escalated via WhatsApp: ${data.escalation_reason}`,
      table_name: 'incidents',
      reference_id: incident.id,
    });

    // Notify managers
    global.sendRoleNotification('manager', 'incident-escalated', {
      type: 'alert',
      title: 'Incident Escalated via WhatsApp',
      message: `Incident ${data.escalation_id} escalated: ${data.escalation_reason}`,
      related_type: 'incident',
      related_id: incident.id
    });

    await conversation.update({ state: 'idle', temp_data: {} });
    await sendWhatsAppMessage(phoneNumber, '✅ Escalation confirmed. Our team will review it shortly.');
    await showMainMenu(conversation, phoneNumber);
  } catch (error) {
    console.error('Error escalating incident:', error);
    await sendWhatsAppMessage(phoneNumber, 'Sorry, there was an error processing your escalation. Please try again.');
    await showMainMenu(conversation, phoneNumber);
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