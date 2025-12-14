const express = require('express');
const multer = require('multer');
const { Incident, ActivityLog } = require('../models');

const router = express.Router();

// Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
});
const upload = multer({ storage });

// Report incident
router.post('/report', upload.array('images', 5), async (req, res) => {
  const { title, description, location, contactName, contactPhone, contactEmail, latitude, longitude } = req.body;
  const images = req.files ? req.files.map(f => f.path).join(',') : null;

  try {
    // Generate tracking ID
    const trackingId = 'INC' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase();

    const incident = await Incident.create({
      title,
      description,
      location,
      contact_name: contactName,
      contact_phone: contactPhone,
      contact_email: contactEmail,
      latitude: latitude ? parseFloat(latitude) : null,
      longitude: longitude ? parseFloat(longitude) : null,
      images,
      tracking_id: trackingId,
      status: 'verified'
    });

    // Log activity
    await ActivityLog.create({
      action: `Incident reported: ${title}`,
      table_name: 'incidents',
      reference_id: incident.id,
    });

    // Send notification to managers
    global.sendRoleNotification('manager', 'new-incident', {
      type: 'alert',
      title: 'New Incident Reported',
      message: `New incident reported: ${title}`,
      related_type: 'incident',
      related_id: incident.id
    });

    res.status(201).json({
      id: incident.id,
      trackingId: trackingId,
      message: 'Incident reported successfully'
    });
  } catch (err) {
    console.error('Error reporting incident:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Check incident progress
router.get('/incidents/status/:trackingId', async (req, res) => {
  try {
    const incident = await Incident.findOne({
      where: { tracking_id: req.params.trackingId },
      include: ['assignedTeam']
    });
    if (!incident) return res.status(404).json({ error: 'Incident not found' });

    res.json({
      id: incident.id,
      trackingId: incident.tracking_id,
      title: incident.title,
      description: incident.description,
      location: incident.location,
      status: incident.status,
      createdAt: incident.created_at,
      assignedTeam: incident.assignedTeam ? {
        id: incident.assignedTeam.id,
        name: incident.assignedTeam.name
      } : null,
      assignedAt: incident.assigned_at,
      images: incident.images ? incident.images.split(',') : []
    });
  } catch (err) {
    console.error('Error fetching incident:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Escalate incident
router.post('/escalate', async (req, res) => {
  const { incidentNumber, description, fullName } = req.body;

  // Validate required fields
  if (!incidentNumber || !description || !fullName) {
    return res.status(400).json({ error: 'Incident number, description, and full name are required' });
  }

  try {
    // Find incident by tracking_id
    const incident = await Incident.findOne({
      where: { tracking_id: incidentNumber }
    });

    if (!incident) {
      return res.status(400).json({ error: 'Invalid incident number.' });
    }

    // Update incident status to escalated
    await incident.update({ status: 'escalated' });

    // Log activity
    await ActivityLog.create({
      action: `Incident escalated: ${incident.title}`,
      table_name: 'incidents',
      reference_id: incident.id,
    });

    // Send notification to managers
    global.sendRoleNotification('manager', 'incident-escalated', {
      type: 'alert',
      title: 'Incident Escalated',
      message: `Incident ${incidentNumber} has been escalated by ${fullName}. Description: ${description}`,
      related_type: 'incident',
      related_id: incident.id
    });

    res.json({ message: 'Incident escalated. The manager has been notified.' });
  } catch (err) {
    console.error('Error escalating incident:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Public stats
router.get('/stats', async (req, res) => {
  try {
    const totalReported = await Incident.count();
    const totalResolved = await Incident.count({ where: { status: 'completed' } });
    res.json({ totalReported, totalResolved });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;