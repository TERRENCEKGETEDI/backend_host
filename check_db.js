const { sequelize, Incident, Message } = require('./models');

async function checkData() {
  try {
    await sequelize.authenticate();

    const incidents = await Incident.findAll({
      attributes: ['id', 'title', 'images']
    });

    console.log('Incidents with images:');
    incidents.forEach(i => {
      if (i.images) {
        console.log(`ID: ${i.id}, Title: ${i.title}, Images: ${i.images}`);
      }
    });

    const messages = await Message.findAll({
      attributes: ['id', 'content', 'attachment_url']
    });

    console.log('\nMessages with attachments:');
    messages.forEach(m => {
      if (m.attachment_url) {
        console.log(`ID: ${m.id}, Content: ${m.content.substring(0, 50)}..., Attachment: ${m.attachment_url}`);
      }
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

checkData();